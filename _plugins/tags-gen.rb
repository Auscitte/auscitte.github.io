#####################################################################################
# Jekyll plugin that populates the {site.source}/tags directory with automatically  #
# generated .html files, one for evey tag referenced in posts.                      #
#                                                                                   #
# Author: Ry Auscitte                                                               #
#                                                                                   #
#####################################################################################

require "set"

module Jekyll
  class JekyllTagFileGenerator < Generator
      safe true
      priority :high
        
      def generate(site)
          
          tagspath = "#{site.source}" + File::SEPARATOR + "tags" + File::SEPARATOR
          tagfiles = Set[]
              paths = Dir[tagspath + "*"]
              paths.each do |f|
                  if File.file?(f)
                      filename = File.basename(f)
                      tagfiles.add(filename)    
                  end
              end

            site.posts.docs.each do |p|
                p.tags.each do |t|
                    filename = t.downcase.gsub(" ", "-") + ".html"
                    if tagfiles === filename
                        next
                    end
                    filetext = %Q(---\nlayout: tag\ntag: #{t}\n---)
                    File.open(tagspath + filename, "w") do |file|
                        file.write(filetext)
                    end
                    tagfiles.add(filename)
                end
            end
      end
  end
end
