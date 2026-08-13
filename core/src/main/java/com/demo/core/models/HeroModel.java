/*
 * Sling Model for the Hero component.
 */
package com.demo.core.models;

import java.util.Objects;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class HeroModel {

    @ValueMapValue
    private String style;

    @ValueMapValue
    private String tagline;

    @ValueMapValue
    private String heading;

    @ValueMapValue
    private String description;

    @ValueMapValue
    private String ctaLabel;

    @ValueMapValue
    private String ctaLink;

    @ValueMapValue
    private String playLabel;

    @ValueMapValue
    private String playLink;

    @ValueMapValue
    private String image;

    @ValueMapValue
    private String imageAlt;

    @ValueMapValue
    private String backgroundImage;

    @ValueMapValue
    private String backgroundImageAlt;

    @ValueMapValue
    private Boolean showDecorations;

    @ValueMapValue
    private String background;

    @ValueMapValue
    private String backgroundHex;

    public String getStyle() {
        return StringUtils.defaultIfBlank(style, "default");
    }

    public String getTagline() {
        return tagline;
    }

    public String getHeading() {
        return heading;
    }

    public String getDescription() {
        return description;
    }

    public String getCtaLabel() {
        return ctaLabel;
    }

    public String getCtaLink() {
        return StringUtils.defaultIfBlank(ctaLink, "#");
    }

    public String getPlayLabel() {
        return playLabel;
    }

    public String getPlayLink() {
        return StringUtils.defaultIfBlank(playLink, "#");
    }

    public String getImage() {
        return image;
    }

    public String getImageAlt() {
        return StringUtils.defaultIfBlank(imageAlt, "");
    }

    public String getBackgroundImage() {
        return backgroundImage;
    }

    public String getBackgroundImageAlt() {
        return StringUtils.defaultIfBlank(backgroundImageAlt, "");
    }

    public boolean isShowDecorations() {
        return showDecorations == null || showDecorations.booleanValue();
    }

    public String getBackgroundStyle() {
        if ("other".equals(background) && StringUtils.isNotBlank(backgroundHex)) {
            String hex = backgroundHex.trim();
            if (!hex.startsWith("#")) {
                hex = "#" + hex;
            }
            return "background-color: " + hex + ";";
        }
        return null;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(tagline)
                || StringUtils.isNotBlank(heading)
                || StringUtils.isNotBlank(description)
                || StringUtils.isNotBlank(ctaLabel)
                || StringUtils.isNotBlank(image)
                || StringUtils.isNotBlank(backgroundImage)
                || Objects.nonNull(showDecorations);
    }
}
